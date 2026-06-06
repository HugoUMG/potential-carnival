interface RichTextProps {
  text?: string | null;
  className?: string;
}

export function RichText({ text, className = '' }: RichTextProps) {
  return <span className={`whitespace-pre-line ${className}`}>{text ?? ''}</span>;
}
