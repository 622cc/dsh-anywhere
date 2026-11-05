// The QR's text: zlib-wrapped DEFLATE (host/src/qr.ts, `deflateSync`), refused past 64 KiB inflated, with a preset
// dictionary, or truncated; as the Android shell's java.util.zip.Inflater (Invite.java).
import Foundation
import zlib

enum Inflate {
    static let limit = 65_536

    static func zlib(_ data: Data) throws -> Data {
        var stream = z_stream()
        guard inflateInit_(&stream, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw LinkFailure("link/invalid") }
        defer { inflateEnd(&stream) }
        var input = [UInt8](data)
        var out = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        return try input.withUnsafeMutableBufferPointer { inp in
            stream.next_in = inp.baseAddress
            stream.avail_in = uInt(inp.count)
            while true {
                let status = buffer.withUnsafeMutableBufferPointer { b -> Int32 in
                    stream.next_out = b.baseAddress
                    stream.avail_out = uInt(b.count)
                    return inflate(&stream, Z_NO_FLUSH)
                }
                let produced = buffer.count - Int(stream.avail_out)
                out.append(contentsOf: buffer[0..<produced])
                if out.count > limit { throw LinkFailure("link/invalid") }
                if status == Z_STREAM_END { return out }
                // Z_NEED_DICT, a corrupt stream, or one that ends before its end (no input left, no output made).
                if status != Z_OK || (produced == 0 && stream.avail_in == 0) { throw LinkFailure("link/invalid") }
            }
        }
    }
}
