import { errorText } from "@/lib/api";
export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-sm font-medium text-bad-foreground">{errorText(error)}</p>;
}
