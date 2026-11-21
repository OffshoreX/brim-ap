import BatchUpload from "@/components/BatchUpload";
import RoleHome from "@/components/RoleHome";

// POST /api/invoices/upload, one file per request. The server decides who may upload (employee, ap_clerk, controller_admin).
export default function UploadPage() {
  return (
    <main>
      <h1>Upload invoices</h1>
      <RoleHome page="/upload" />
      <BatchUpload />
    </main>
  );
}
