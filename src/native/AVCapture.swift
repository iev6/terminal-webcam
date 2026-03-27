import AVFoundation
import CoreVideo
import CoreMedia
import Accelerate
import Foundation

// --- Global state ---
private var captureSession: AVCaptureSession?
private var captureDelegate: CaptureDelegate?
private var outputBuffer: UnsafeMutablePointer<UInt8>?
private var outputWidth: Int = 0
private var outputHeight: Int = 0
private var hasFrame: Bool = false
private let frameLock = NSLock()
private var colorMode: Bool = false

// --- Delegate ---
class CaptureDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        frameLock.lock()
        defer { frameLock.unlock() }

        guard let dst = outputBuffer, outputWidth > 0, outputHeight > 0 else { return }

        if colorMode {
            // COLOR PATH: BGRA base address → scale ARGB8888 → convert to RGB24
            guard let bgraBase = CVPixelBufferGetBaseAddress(imageBuffer) else { return }
            let srcWidth  = CVPixelBufferGetWidth(imageBuffer)
            let srcHeight = CVPixelBufferGetHeight(imageBuffer)
            let srcRowBytes = CVPixelBufferGetBytesPerRow(imageBuffer)

            let tmpSize = outputWidth * outputHeight * 4
            let tmpBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: tmpSize)
            defer { tmpBuf.deallocate() }

            var srcVImage = vImage_Buffer(
                data: bgraBase,
                height: vImagePixelCount(srcHeight),
                width: vImagePixelCount(srcWidth),
                rowBytes: srcRowBytes
            )
            var tmpVImage = vImage_Buffer(
                data: tmpBuf,
                height: vImagePixelCount(outputHeight),
                width: vImagePixelCount(outputWidth),
                rowBytes: outputWidth * 4
            )

            // Scale BGRA (treated as ARGB8888 — same 4-channel layout)
            vImageScale_ARGB8888(&srcVImage, &tmpVImage, nil, vImage_Flags(kvImageNoFlags))

            // Convert BGRA8888 → RGB888 into output buffer
            var rgbVImage = vImage_Buffer(
                data: dst,
                height: vImagePixelCount(outputHeight),
                width: vImagePixelCount(outputWidth),
                rowBytes: outputWidth * 3
            )
            vImageConvert_BGRA8888toRGB888(&tmpVImage, &rgbVImage, vImage_Flags(kvImageNoFlags))

        } else {
            // GRAYSCALE PATH: Y plane is already luma — no colorspace conversion needed
            guard let yBase = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 0) else { return }
            let srcWidth    = CVPixelBufferGetWidthOfPlane(imageBuffer, 0)
            let srcHeight   = CVPixelBufferGetHeightOfPlane(imageBuffer, 0)
            let srcRowBytes = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 0)

            var srcVImage = vImage_Buffer(
                data: yBase,
                height: vImagePixelCount(srcHeight),
                width: vImagePixelCount(srcWidth),
                rowBytes: srcRowBytes
            )
            var dstVImage = vImage_Buffer(
                data: dst,
                height: vImagePixelCount(outputHeight),
                width: vImagePixelCount(outputWidth),
                rowBytes: outputWidth
            )
            vImageScale_Planar8(&srcVImage, &dstVImage, nil, vImage_Flags(kvImageNoFlags))
        }

        hasFrame = true
    }
}

// --- Private helper: start (or restart) a capture session ---
private func _av_capture_start_session(width: Int, height: Int) -> Bool {
    let session = AVCaptureSession()
    session.sessionPreset = .medium  // typically 480x360 — fast and sufficient

    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
        return false
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    if colorMode {
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
    } else {
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        ]
    }
    output.alwaysDiscardsLateVideoFrames = true

    let delegate = CaptureDelegate()
    captureDelegate = delegate
    let queue = DispatchQueue(label: "com.terminalwebcam.capture", qos: .userInteractive)
    output.setSampleBufferDelegate(delegate, queue: queue)

    guard session.canAddOutput(output) else { return false }
    session.addOutput(output)

    session.startRunning()
    captureSession = session
    return true
}

// --- Exported C functions ---

@_cdecl("av_capture_init")
public func av_capture_init(width: Int32, height: Int32) -> Int32 {
    let w = Int(width)
    let h = Int(height)

    outputWidth = w
    outputHeight = h
    let stride = colorMode ? 3 : 1
    outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: w * h * stride)

    return _av_capture_start_session(width: w, height: h) ? 1 : 0
}

@_cdecl("av_capture_set_color")
public func av_capture_set_color(enabled: Int32) {
    let newColorMode = enabled != 0

    frameLock.lock()
    colorMode = newColorMode
    outputBuffer?.deallocate()
    let stride = colorMode ? 3 : 1
    outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: outputWidth * outputHeight * stride)
    hasFrame = false
    frameLock.unlock()

    // Restart session so the pixel format setting takes effect
    captureSession?.stopRunning()
    captureSession = nil
    captureDelegate = nil
    _ = _av_capture_start_session(width: outputWidth, height: outputHeight)
}

@_cdecl("av_capture_get_frame")
public func av_capture_get_frame(buffer: UnsafeMutablePointer<UInt8>, size: Int32) -> Int32 {
    frameLock.lock()
    defer { frameLock.unlock() }

    guard hasFrame, let src = outputBuffer else { return 0 }

    let stride = colorMode ? 3 : 1
    let bytes = min(Int(size), outputWidth * outputHeight * stride)
    buffer.initialize(from: src, count: bytes)
    return Int32(bytes)
}

@_cdecl("av_capture_update_resolution")
public func av_capture_update_resolution(width: Int32, height: Int32) {
    let w = Int(width)
    let h = Int(height)

    frameLock.lock()
    defer { frameLock.unlock() }

    if w != outputWidth || h != outputHeight {
        outputBuffer?.deallocate()
        outputWidth = w
        outputHeight = h
        let stride = colorMode ? 3 : 1
        outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: w * h * stride)
        hasFrame = false
    }
}

@_cdecl("av_capture_stop")
public func av_capture_stop() {
    captureSession?.stopRunning()
    captureSession = nil
    captureDelegate = nil

    frameLock.lock()
    outputBuffer?.deallocate()
    outputBuffer = nil
    hasFrame = false
    outputWidth = 0
    outputHeight = 0
    frameLock.unlock()
}
