export const navItems = [
  { href: '/', label: 'Home', icon: 'home', variant: 'scarlet' },
  { href: '/projects', label: 'Projects', icon: 'grid', variant: 'tangerine' },
  { href: '/about', label: 'About me', icon: 'person', variant: 'gold' },
] as const;

/** The link's own page. Child routes are not seated, so the button can still be pressed. */
export function isCurrentPage(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  const target = href.replace(/\/+$/, '') || '/';
  return path === target;
}
