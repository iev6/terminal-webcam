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

// --- Delegate ---
class CaptureDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        // Y plane = grayscale
        guard let yBase = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 0) else { return }
        let srcWidth = CVPixelBufferGetWidthOfPlane(imageBuffer, 0)
        let srcHeight = CVPixelBufferGetHeightOfPlane(imageBuffer, 0)
        let srcRowBytes = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 0)

        frameLock.lock()
        defer { frameLock.unlock() }

        guard let dst = outputBuffer, outputWidth > 0, outputHeight > 0 else { return }

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
        hasFrame = true
    }
}

// --- Exported C functions ---

@_cdecl("av_capture_init")
public func av_capture_init(width: Int32, height: Int32) -> Int32 {
    let w = Int(width)
    let h = Int(height)

    outputWidth = w
    outputHeight = h
    outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: w * h)

    let session = AVCaptureSession()
    session.sessionPreset = .medium  // typically 480x360 — fast and sufficient

    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
        return 0
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    ]
    output.alwaysDiscardsLateVideoFrames = true

    let delegate = CaptureDelegate()
    captureDelegate = delegate
    let queue = DispatchQueue(label: "com.terminalwebcam.capture", qos: .userInteractive)
    output.setSampleBufferDelegate(delegate, queue: queue)

    guard session.canAddOutput(output) else { return 0 }
    session.addOutput(output)

    session.startRunning()
    captureSession = session
    return 1
}

@_cdecl("av_capture_get_frame")
public func av_capture_get_frame(buffer: UnsafeMutablePointer<UInt8>, size: Int32) -> Int32 {
    frameLock.lock()
    defer { frameLock.unlock() }

    guard hasFrame, let src = outputBuffer else { return 0 }

    let bytes = min(Int(size), outputWidth * outputHeight)
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
        outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: w * h)
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
