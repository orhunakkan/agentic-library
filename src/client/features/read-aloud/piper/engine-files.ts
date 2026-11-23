import piperData from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url'
import piperWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import workerUrl from './piper.worker.ts?worker&url'

export const ENGINE_FILES = { ortWasm, piperWasm, piperData }

export const WORKER_URL = workerUrl

export const ENGINE_URLS: readonly string[] = [ortWasm, piperWasm, piperData, workerUrl]
