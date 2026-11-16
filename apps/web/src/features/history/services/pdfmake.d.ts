/**
 * The subset of `pdfmake` 0.3 that `./pdf.ts` uses (story 14.3). The package
 * ships no types, and no `@types/pdfmake` is installed: only what the one
 * writer module calls is declared here.
 */

declare module 'pdfmake/build/pdfmake' {
  interface PdfMakeDocument {
    /** Builds the file and hands it to the browser as a download. */
    download(fileName: string): Promise<void>;
  }

  interface PdfMake {
    /** Registers font files (name → base64) for the default font table (Roboto). */
    addVirtualFileSystem(vfs: Readonly<Record<string, string>>): void;
    createPdf(definition: object): PdfMakeDocument;
  }

  const pdfMake: PdfMake;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  /** The bundled Roboto faces, file name → base64. */
  const vfs: Readonly<Record<string, string>>;
  export default vfs;
}
