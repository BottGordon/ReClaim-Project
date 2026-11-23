import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export function useImageCrop() {
  const [selection, setSelection] = useState<{
    source: string
    maxDimension?: number
    onApply: (photo: string) => void | Promise<void>
  }>()
  const request = useRef(0)

  useEffect(() => () => { request.current++ }, [])

  function chooseImage(file: File, onApply: (photo: string) => void | Promise<void>, onError: (message: string) => void, maxDimension?: number) {
    const version = ++request.current
    const reader = new FileReader()
    reader.onload = () => {
      if (version === request.current) setSelection({ source: String(reader.result), onApply, maxDimension })
    }
    reader.onerror = () => {
      if (version === request.current) onError("Could not read that photo.")
    }
    reader.readAsDataURL(file)
  }

  return {
    chooseImage,
    cropDialog: selection && createPortal(
      <ImageCrop source={selection.source} maxDimension={selection.maxDimension} onApply={selection.onApply} onClose={() => setSelection(undefined)} />,
      document.body,
    ),
  }
}

function ImageCrop({ source, maxDimension, onApply, onClose }: {
  source: string
  maxDimension?: number
  onApply: (photo: string) => void | Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [horizontal, setHorizontal] = useState(50)
  const [vertical, setVertical] = useState(50)
  const [error, setError] = useState("")
  const { width, height } = dimensions
  const side = Math.min(width, height) / zoom
  const x = (width - side) * horizontal / 100
  const y = (height - side) * vertical / 100

  useEffect(() => { dialog.current?.showModal() }, [])

  function apply(photo: string) {
    onClose()
    void onApply(photo)
  }

  function saveImage(cropped: boolean) {
    if (!image.current || !side) return
    if (!cropped && !maxDimension) {
      apply(source)
      return
    }

    const sourceWidth = cropped ? side : width
    const sourceHeight = cropped ? side : height
    const scale = Math.min(1, (maxDimension ?? 1200) / Math.max(sourceWidth, sourceHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) {
      setError("Could not prepare the photo. Try another image.")
      return
    }
    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image.current, cropped ? x : 0, cropped ? y : 0,
      sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    apply(canvas.toDataURL("image/jpeg", maxDimension ? 0.82 : 0.9))
  }

  return (
    <dialog ref={dialog} aria-label="Adjust photo" onCancel={onClose}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-auto rounded-2xl bg-white p-5 text-navy shadow-xl backdrop:bg-black/60">
      <h2 className="font-display text-xl font-bold">Adjust photo</h2>
      <div className="relative mx-auto my-4 aspect-square w-full max-w-[min(16rem,34dvh)] overflow-hidden rounded-lg bg-[#f5f2ec]">
        <img ref={image} src={source} alt="Photo crop preview"
          onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setError("Could not open that photo. Choose another file.")}
          className="absolute max-w-none"
          style={side ? { width: (width / side) * 100 + "%", left: -(x / side) * 100 + "%", top: -(y / side) * 100 + "%" } : { visibility: "hidden" }} />
      </div>
      {side > 0 && (
        <div className="space-y-2">
          <label className="block text-sm">Zoom <input className="block w-full" type="range" min={1} max={4} step={0.05} value={zoom} onChange={(event) => setZoom(event.currentTarget.valueAsNumber)} /></label>
          <label className="block text-sm">Horizontal position <input className="block w-full" type="range" value={horizontal} disabled={width <= side} onChange={(event) => setHorizontal(event.currentTarget.valueAsNumber)} /></label>
          <label className="block text-sm">Vertical position <input className="block w-full" type="range" value={vertical} disabled={height <= side} onChange={(event) => setVertical(event.currentTarget.valueAsNumber)} /></label>
        </div>
      )}
      {error && <p role="alert" className="form-error mt-3">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="btn-small" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-small" disabled={!side} onClick={() => saveImage(false)}>{maxDimension ? "Use full photo" : "Use original"}</button>
        <button type="button" className="btn-small" disabled={!side} onClick={() => saveImage(true)}>Use crop</button>
      </div>
    </dialog>
  )
}
