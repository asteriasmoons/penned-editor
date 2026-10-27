import AppKit
import CryptoKit
import Foundation

struct Catalog: Decodable { struct Symbol: Decodable { let name: String }; let symbols: [Symbol] }
let arguments = CommandLine.arguments
let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[1])))
let directory = URL(fileURLWithPath: arguments[2])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
var manifest: [String: String] = [:]
for symbol in catalog.symbols {
    autoreleasepool {
        guard let source = NSImage(systemSymbolName: symbol.name, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 96, weight: .regular)),
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 128, pixelsHigh: 128,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return }
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
        let scale = min(112 / source.size.width, 112 / source.size.height)
        let size = NSSize(width: source.size.width * scale, height: source.size.height * scale)
        source.draw(in: NSRect(x: (128-size.width)/2, y: (128-size.height)/2, width: size.width, height: size.height))
        NSGraphicsContext.restoreGraphicsState()
        guard let png = bitmap.representation(using: .png, properties: [:]) else { return }
        let hash = SHA256.hash(data: Data(symbol.name.utf8) + png).prefix(12).map { String(format: "%02x", $0) }.joined()
        let filename = hash + ".png"
        do {
            try png.write(to: directory.appendingPathComponent(filename))
            manifest["sf:" + symbol.name] = "/viewer-assets/symbols/" + filename
        } catch { fatalError("Could not export a native symbol: \(error)") }
    }
}
try JSONEncoder().encode(manifest).write(to: URL(fileURLWithPath: arguments[3]))
