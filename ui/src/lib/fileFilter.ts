/**
 * Extensions of a connection-form file field's filter: "*.pem;*.crt" (a list) or the dialog style
 * "Certificates|*.pem;*.crt|All files|*.*" (labels and the catch-all are dropped).
 */
export function fileFilterExtensions(filter: string | null | undefined): string[] {
  return (filter ?? '').split(/[;|]/).map((s) => s.trim()).filter((s) => /^\*\.[\w-]+$/.test(s)).map((s) => s.slice(2));
}
