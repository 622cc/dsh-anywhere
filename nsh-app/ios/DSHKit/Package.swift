// swift-tools-version: 6.0
// What the iOS shell decides without the system: pairing input it accepts or refuses (Invite), the certificate
// fields that decision reads (DER) and the QR's zlib text (Inflate). `swift test` runs it on the Mac.
import PackageDescription

let package = Package(
    name: "DSHKit",
    platforms: [.iOS(.v17), .macOS(.v15)],
    products: [.library(name: "DSHKit", targets: ["DSHKit"])],
    targets: [
        .target(name: "DSHKit"),
        .testTarget(name: "DSHKitTests", dependencies: ["DSHKit"], resources: [.copy("Fixtures")]),
    ],
    swiftLanguageModes: [.v5] // Network.framework callbacks and the bridge's closures predate strict sendability
)
