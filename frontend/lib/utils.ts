import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function combineClassNames(...classValues: ClassValue[]) {
  return twMerge(clsx(classValues));
}
