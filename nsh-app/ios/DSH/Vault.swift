// The phone's link to its computer (Tailcat client key, invitation, device token) in the Keychain, readable after the
// first unlock and never carried to another device by a backup (as the Android shell's Keystore-sealed no-backup file).
import DSHKit
import Foundation
import Security

final class Vault {
    private let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "io.jingtao.dshanywhere",
        kSecAttrAccount as String: "dsh-link",
    ]

    func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ json: String) throws {
        let data = Data(json.utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        // The status rides along for logs (the app words link/save alone): -34018 is an app without a keychain entitlement.
        if status != errSecSuccess { throw LinkFailure("link/save:\(status)") }
    }

    func clear() { SecItemDelete(query as CFDictionary) }
}
