declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PiperPhonemizeModule {
    callMain: (args: string[]) => number
  }
  interface PiperPhonemizeOptions {
    print?: (line: string) => void
    printErr?: (line: string) => void
    locateFile?: (path: string) => string
    wasmBinary?: ArrayBuffer
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer
  }
  const createPiperPhonemize: (options?: PiperPhonemizeOptions) => Promise<PiperPhonemizeModule>
  export default createPiperPhonemize
}
