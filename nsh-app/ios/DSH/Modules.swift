// Generated interfaces: the app asks `ui.open { url, rootUrl, auth, title }` for a module the DSH agent built with the
// companion's show_interface tool. This downloads the signed package and the companion's root key over the device-key
// channel, verifies the package against that root (NshTrust) and runs it full screen in its own NshAppView, with no
// network and only `ui.close` (as the Android shell's Modules.java).
import DSHKit
import NativeShell
import UIKit

final class Modules {
    private weak var host: UIViewController?

    init(host: UIViewController) { self.host = host }

    @MainActor
    func attach(_ view: NshAppView) {
        view.handle("ui.open") { [weak self] data, reply in
            let args = data as? [String: Any] ?? [:]
            let url = args["url"] as? String ?? "", rootUrl = args["rootUrl"] as? String ?? ""
            let auth = args["auth"] as? String ?? "", title = args["title"] as? String ?? ""
            guard let u = URL(string: url), let r = URL(string: rootUrl), !url.isEmpty, !rootUrl.isEmpty, !auth.isEmpty else {
                return reply.reject("ui.open needs url, rootUrl and auth")
            }
            Task { @MainActor in
                do {
                    let root = String(decoding: try await Modules.get(r, auth: auth), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                    let file = FileManager.default.temporaryDirectory.appendingPathComponent("module.nshpkg")
                    try await Modules.get(u, auth: auth).write(to: file)
                    let trust: NshTrust
                    do { trust = try NshTrust(stateDirectory: try Modules.dir("nsh-trust")) } catch { throw LinkFailure("ui/storage") }
                    do { try trust.addRoot(root) } catch { throw LinkFailure("ui/root-key") }
                    let package = try await trust.openPackage(at: file) // verifies; a refused package throws and nothing shows
                    self?.host?.present(ModuleScreen(title: title, package: package), animated: true)
                    reply.resolve(nil)
                } catch {
                    reply.reject((error as? LinkFailure)?.code ?? "\(error)")
                }
            }
        }
    }

    private static func dir(_ name: String) throws -> URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func get(_ url: URL, auth: String) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw LinkFailure("ui/download:\(status)") }
        return data
    }
}

/// Full screen over the app: the title and Done, then the module.
private final class ModuleScreen: UIViewController {
    private let app = NshAppView()
    private let package: NshPackage
    private let heading: String

    init(title: String, package: NshPackage) {
        self.package = package
        heading = title
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .dshBackground
        let label = UILabel()
        label.text = heading
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textColor = .dshForeground
        let done = UIButton(type: .system, primaryAction: UIAction(title: Words.done) { [weak self] _ in self?.dismiss(animated: true) })
        done.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        done.tintColor = .dshForeground
        let bar = UIStackView(arrangedSubviews: [label, done])
        bar.alignment = .center
        bar.translatesAutoresizingMaskIntoConstraints = false
        app.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        view.addSubview(app)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            bar.heightAnchor.constraint(equalToConstant: 52),
            app.topAnchor.constraint(equalTo: bar.bottomAnchor),
            app.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            app.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            app.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        try? app.grantCapabilities(#"{"host":["ui.close"]}"#)
        app.handle("ui.close") { [weak self] _, reply in self?.dismiss(animated: true); reply.resolve(nil) }
        app.run(package)
    }
}
