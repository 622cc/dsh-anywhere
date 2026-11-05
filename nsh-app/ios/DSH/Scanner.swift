// link.scan: the camera reads one QR code (VisionKit's DataScannerViewController) and gives its text, or "cancelled".
// A phone without the scanner (the simulator, a camera the person refused) is link/scan-unavailable: the app's paste
// field still pairs.
import DSHKit
import UIKit
import VisionKit

final class Scanner: NSObject, DataScannerViewControllerDelegate {
    private let done: (Result<String, Error>) -> Void
    private weak var shown: UIViewController?
    private var finished = false

    private init(_ done: @escaping (Result<String, Error>) -> Void) { self.done = done }

    @MainActor
    static func present(from host: UIViewController, _ done: @escaping (Result<String, Error>) -> Void) -> Scanner? {
        guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
            done(.failure(LinkFailure("link/scan-unavailable")))
            return nil
        }
        let s = Scanner(done)
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                                recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
                                                isHighlightingEnabled: true)
        scanner.delegate = s
        scanner.title = Words.scanTitle
        scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak s] _ in s?.finish(.failure(LinkFailure("cancelled"))) })
        let nav = UINavigationController(rootViewController: scanner)
        nav.modalPresentationStyle = .fullScreen
        nav.presentationController?.delegate = s
        s.shown = nav
        host.present(nav, animated: true) {
            do { try scanner.startScanning() } catch { s.finish(.failure(LinkFailure("link/scan-unavailable"))) }
        }
        return s
    }

    func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in items {
            if case .barcode(let code) = item, let text = code.payloadStringValue { return finish(.success(text)) }
        }
    }

    func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        finish(.failure(LinkFailure("link/scan-unavailable")))
    }

    private func finish(_ result: Result<String, Error>) {
        guard !finished else { return }
        finished = true
        shown?.dismiss(animated: true)
        done(result)
    }
}

extension Scanner: UIAdaptivePresentationControllerDelegate {
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish(.failure(LinkFailure("cancelled"))) }
}
