export const navItems = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/projects', label: 'Projects', icon: 'grid' },
  { href: '/about', label: 'About me', icon: 'person' },
] as const;

/** Whether a nav link should be seated for the given pathname (sub-routes included). */
export function isCurrentPath(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}
