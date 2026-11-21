"use client";
import Link from "next/link";
import { Empty, Table } from "@/components/ui";
import { Load } from "@/components/api";

type Vendor = { id: number; name: string; category: string | null; status: string | null; province_or_state: string | null; payment_terms_days: number | null; bank_account_last4: string };

// GET /api/vendors
export default function VendorsPage() {
  return (
    <main id="main">
      <h1>Vendors</h1>
      <Load<Vendor[]> url="/api/vendors">
        {(vendors) => vendors.length === 0 ? <Empty href="/upload" next="Upload an invoice">No vendors found. Vendors appear when an invoice names one.</Empty> : (
          <Table>
            <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Province</th><th className="num">Terms (days)</th><th>Bank acct</th></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td><Link href={`/vendors/${v.id}`}>{v.name}</Link></td><td>{v.category}</td><td>{v.status}</td><td>{v.province_or_state}</td>
                  <td className="num">{v.payment_terms_days}</td><td>…{v.bank_account_last4}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Load>
    </main>
  );
}
