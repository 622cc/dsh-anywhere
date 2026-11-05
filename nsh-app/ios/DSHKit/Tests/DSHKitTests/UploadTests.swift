// A file the person picks goes to DSH's raw upload route through the companion (/dsh/api/session/uploadFileBinary),
// with the device token in the header; the receipt comes back for the message to cite (as android UploadTest).
import DSHKit
import Foundation
import XCTest

final class UploadTests: XCTestCase {
    private func file(_ bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data(bytes).write(to: url)
        return url
    }

    func testUploadsTheBytesAndReturnsTheReceipt() async throws {
        let server = try Loopback(status: 200, answer: #"{"ok":true,"value":{"receiptId":"r1","file":{"attachmentId":"a1","name":"q 1&2.pdf","bytes":3}}}"#)
        let value = try await Upload.send(origin: "http://127.0.0.1:\(server.port)/dsh", token: "device-token", sessionId: "s/1", name: "q 1&2.pdf", file: try file([1, 2, 3]))
        XCTAssertEqual(value["receiptId"] as? String, "r1")
        XCTAssertEqual((value["file"] as? [String: Any])?["attachmentId"] as? String, "a1")
        let s = try XCTUnwrap(server.request)
        XCTAssertEqual(s.method, "POST")
        XCTAssertEqual(s.path, "/dsh/api/session/uploadFileBinary")
        XCTAssertEqual(s.query, "sessionId=s%2F1&name=q%201%262.pdf")
        XCTAssertEqual(s.headers["authorization"], "Bearer device-token")
        XCTAssertEqual(s.headers["content-type"], "application/octet-stream")
        XCTAssertEqual(s.body, Data([1, 2, 3]))
    }

    func testARefusalCarriesDshsMessage() async throws {
        let server = try Loopback(status: 200, answer: #"{"ok":false,"error":{"code":"x","message":"too large"}}"#)
        do {
            _ = try await Upload.send(origin: "http://127.0.0.1:\(server.port)/dsh", token: "t", sessionId: "s", name: "f", file: try file([1]))
            XCTFail("no error")
        } catch { XCTAssertEqual(error.localizedDescription, "too large") }
    }

    func testAnHttpFailureOrUnreadableAnswerHasItsCode() async throws {
        for (status, answer, code) in [(500, "{}", "upload/failed:500"), (200, "not json", "upload/unreadable"), (200, #"{"ok":false}"#, "upload/refused")] {
            let server = try Loopback(status: status, answer: answer)
            do {
                _ = try await Upload.send(origin: "http://127.0.0.1:\(server.port)/dsh", token: "t", sessionId: "s", name: "f", file: try file([1]))
                XCTFail("no error for \(code)")
            } catch { XCTAssertEqual(error.localizedDescription, code) }
        }
    }
}
