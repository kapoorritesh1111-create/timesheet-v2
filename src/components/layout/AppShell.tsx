import TopNav from "./TopNav";

export default function AppShell({
  title,
  subtitle,
  right,
  children,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="appShell">
      <TopNav />

      <div className="container">
        {(title || subtitle || right) && (
          <div className="pageHeader">
            <div>
              {title ? <h1 className="pageTitle">{title}</h1> : null}
              {subtitle ? <div className="pageSubtitle">{subtitle}</div> : null}
            </div>
            {right ? <div>{right}</div> : null}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
