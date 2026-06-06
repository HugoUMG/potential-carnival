interface RichTextProps {
  text?: string | null;
  className?: string;
}
export function RichText({ text, className = '' }: RichTextProps) {
  const processed = (text ?? '').replace(/\\n/g, '\n');
  return <span className={`whitespace-pre-line ${className}`}>{processed}</span>;
}