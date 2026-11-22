// Vitest global setup — in-memory IndexedDB so store/db tests run anywhere.
import 'fake-indexeddb/auto'

// jsdom's Blob predates arrayBuffer()/text() — polyfill via FileReader so
// tests can exercise blob code paths (the app only calls these in browsers).
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.readAsArrayBuffer(this)
    })
  }
}
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.readAsText(this)
    })
  }
}
