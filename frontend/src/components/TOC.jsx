export default function TOC({ toc, currentPage, onNavigate }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="toc-header">Table of Contents</div>
      {toc.length === 0 ? (
        <div className="toc-empty">
          No table of contents.<br />Add entries in Admin.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {toc.map((entry, i) => (
            <div
              key={i}
              className={`toc-item ${currentPage === entry.page ? 'active' : ''}`}
              onClick={() => onNavigate(entry.page)}
            >
              <span className="toc-page-num">{entry.page}</span>
              <span className="toc-label">{entry.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
