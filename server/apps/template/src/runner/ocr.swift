// Đọc chữ trên ảnh (Apple Vision, có sẵn trong macOS). ocr.js build file này 1 lần rồi gọi.
// In JSON: [{ "text", "conf", "x", "y", "w", "h" }] — khung theo tỉ lệ 0..1 của ảnh, gốc trên-trái.
import AppKit
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("không đọc được ảnh\n".data(using: .utf8)!)
  exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([req])
var out: [[String: Any]] = []
for o in req.results ?? [] {
  guard let c = o.topCandidates(1).first else { continue }
  let b = o.boundingBox
  out.append(["text": c.string, "conf": c.confidence, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
}
let data = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)
