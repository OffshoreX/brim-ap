import BatchUpload from "@/components/BatchUpload";

// POST /api/invoices/upload, one file per request. The server decides who may upload (employee, ap_clerk, controller_admin).
export default function UploadPage() {
  return (
    <main>
      <h1>Upload invoices</h1>
      <BatchUpload />
    </main>
  );
}
