import { Link, useParams } from "react-router-dom";
import { useData, Loading, ErrorBox, n } from "../ui.jsx";

const longDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Printable delivery challan. "Print / Save as PDF" uses the browser's print dialog. */
export default function ChallanPrint() {
  const { id } = useParams();
  const { data, error } = useData(`/challans/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { challan: ch, items, consignees, company: co } = data;
  const toGodown = ch.kind === "Factory → Godown", toFactory = ch.kind === "Godown → Factory";
  const totals = items.reduce((a, i) => ({ sacks: a.sacks + i.sacks, pieces: a.pieces + i.pieces, kg: a.kg + i.kg }), { sacks: 0, pieces: 0, kg: 0 });

  return (
    <div className="doc-wrap">
      <div className="doc-bar no-print">
        <Link to="/dispatch" className="card-link">← Dispatch</Link>
        <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <article className="doc">
        {ch.cancelled_on && <div className="doc-void">CANCELLED</div>}
        <header className="doc-head">
          <div>
            <div className="doc-co">{co.name || "Company name"}</div>
            <div className="doc-small">{co.address}</div>
            <div className="doc-small">{[co.phone && `Ph: ${co.phone}`, co.gstin && `GSTIN: ${co.gstin}`].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="doc-title">
            <div>DELIVERY CHALLAN</div>
            <div className="doc-small">{toGodown || toFactory ? "Stock transfer (not for sale)" : "Goods sent to customer"}</div>
          </div>
        </header>

        <section className="doc-meta">
          <div><span>Challan no.</span><b>{ch.challan_no}</b></div>
          <div><span>Date</span><b>{longDate(ch.date)}</b></div>
          <div><span>Vehicle no.</span><b>{ch.vehicle}</b></div>
          <div><span>Movement</span><b>{ch.kind}</b></div>
        </section>

        <section className="doc-parties">
          <div>
            <span className="doc-label">From (consignor)</span>
            <b>{co.name}</b>
            <div>{toFactory ? "Godown" : "Factory"}{co.address ? `, ${co.address}` : ""}</div>
          </div>
          <div>
            <span className="doc-label">To (consignee)</span>
            {toGodown ? <><b>{co.name}</b><div>Godown</div></> : toFactory ? <><b>{co.name}</b><div>Factory</div></> : consignees.map((c, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <b>{c.name}</b>
                <div>{[c.address, c.city].filter(Boolean).join(", ")}</div>
                <div className="doc-small">{[c.phone && `Ph: ${c.phone}`, c.gstin && `GSTIN: ${c.gstin}`].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
            {ch.destination && !toGodown && !toFactory && <div className="doc-small">Destination: {ch.destination}</div>}
          </div>
        </section>

        <table className="doc-table">
          <thead><tr><th>#</th><th>Description of goods</th><th>Order</th>{co.hsn && <th>HSN</th>}<th className="num">Sacks</th><th className="num">Bags (pcs)</th><th className="num">Weight (kg)</th></tr></thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={i.order_id}>
                <td>{k + 1}</td>
                <td>{i.description}<div className="doc-small">Sacks: {i.sack_nos}</div></td>
                <td>{i.order_no}</td>
                {co.hsn && <td>{co.hsn}</td>}
                <td className="num">{i.sacks}</td><td className="num">{n(i.pieces)}</td><td className="num">{i.kg.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={co.hsn ? 4 : 3}><b>Total</b></td><td className="num"><b>{totals.sacks}</b></td><td className="num"><b>{n(totals.pieces)}</b></td><td className="num"><b>{totals.kg.toFixed(1)}</b></td></tr></tfoot>
        </table>

        <p className="doc-small" style={{ marginTop: 10 }}>Goods sent in good condition. Please check and sign on receipt.</p>

        <footer className="doc-sign">
          <div><div className="doc-line" />Receiver's signature &amp; date</div>
          <div><div className="doc-line" />Driver</div>
          <div><div className="doc-line" />For {co.name || "the company"} (authorised signatory)</div>
        </footer>
      </article>
    </div>
  );
}
