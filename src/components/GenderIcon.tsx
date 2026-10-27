import type { SVGProps } from 'react';

type GenderIconProps = SVGProps<SVGSVGElement> & {
  gender: 'female' | 'male';
  size?: number;
};

export function GenderIcon({ gender, size = 16, ...props }: GenderIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {gender === 'female' ? (
        <>
          <circle cx="12" cy="9" r="5" />
          <path d="M12 14v7" />
          <path d="M9 18h6" />
        </>
      ) : (
        <>
          <circle cx="10" cy="14" r="5" />
          <path d="M14 10 21 3" />
          <path d="M16 3h5v5" />
        </>
      )}
    </svg>
  );
}
