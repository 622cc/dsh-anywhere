// A file for a message, sent as DSH's raw upload (POST /api/session/uploadFileBinary, the bytes as the body) through
// the companion's /dsh relay. DSH answers {"ok":true,"value":{receiptId,file}} or {"ok":false,"error":{code,message}};
// the message then cites the receipt (docs/research/dsh-protocol-parity.md, section 4). As android Upload.java.
import Foundation

public enum Upload {
    /// Streams `file` to DSH for the chat `sessionId`; returns {receiptId, file}.
    public static func send(origin: String, token: String, sessionId: String, name: String, file: URL) async throws -> [String: Any] {
        guard let url = URL(string: origin + "/api/session/uploadFileBinary?sessionId=\(component(sessionId))&name=\(component(name))") else {
            throw LinkFailure("upload/failed:url")
        }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await URLSession.shared.upload(for: request, fromFile: file) // read from disk as it goes
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw LinkFailure("upload/failed:\(status)") }
        guard let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw LinkFailure("upload/unreadable") }
        guard answer["ok"] as? Bool == true else {
            throw LinkFailure(((answer["error"] as? [String: Any])?["message"] as? String) ?? "upload/refused")
        }
        guard let value = answer["value"] as? [String: Any] else { throw LinkFailure("upload/unreadable") }
        return value
    }

    /// A query value: everything but RFC 3986's unreserved characters percent-encoded.
    static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")) ?? ""
    }
}
