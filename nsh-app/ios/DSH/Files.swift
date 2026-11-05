// files.pick { sessionId } → the receipt of the file the person picked, uploaded for that chat (DSHKit Upload), or null
// when they cancel. The system's document picker hands over a copy of the picked file only, so the app needs no
// access to the person's files (as the Android shell's Files.java).
import DSHKit
import NativeShell
import UIKit
import UniformTypeIdentifiers

final class Files: NSObject, UIDocumentPickerDelegate {
    private weak var host: UIViewController?
    private let link: Link
    private var pending: NshHostReply?
    private var sessionId: String?

    init(host: UIViewController, link: Link) { self.host = host; self.link = link }

    @MainActor
    func attach(_ view: NshAppView) {
        view.handle("files.pick") { [self] data, reply in
            guard pending == nil else { return reply.reject("busy") }
            guard let id = (data as? [String: Any])?["sessionId"] as? String else { return reply.reject("sessionId is required") }
            pending = reply; sessionId = id
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            host?.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let reply = pending, let id = sessionId else { return }
        pending = nil; sessionId = nil
        guard let file = urls.first else { return reply.resolve(nil) }
        Task.detached { [link] in
            do {
                let to = try link.endpoint()
                let value = try await Upload.send(origin: to.origin, token: to.token, sessionId: id, name: file.lastPathComponent, file: file)
                reply.resolve(value)
            } catch {
                reply.reject((error as? LinkFailure)?.code ?? error.localizedDescription)
            }
            try? FileManager.default.removeItem(at: file) // the picker's copy
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let reply = pending
        pending = nil; sessionId = nil
        reply?.resolve(nil)
    }
}
