/** Re-mounted on every navigation, giving each page a short entrance animation. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
