import { redirect } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";
import { getServerAuthContext } from "@/lib/auth/guards";
import { MedoraLogo } from "@/components/MedoraLogo";

export default async function DashboardRouterPage() {
  const ctx = await getServerAuthContext();
  if (!ctx) {
    redirect("/auth/signin");
  }

  if (ctx.accountStatus === "PENDING_APPROVAL") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-medora-mist px-4">
        <div className="medora-card max-w-md p-8 text-center">
          <div className="flex justify-center">
            <MedoraLogo href="/" />
          </div>
          <Clock className="mx-auto mt-6 h-10 w-10 text-amber-600" />
          <h1 className="mt-4 text-xl font-extrabold text-medora-navy">
            Staff Verification Pending
          </h1>
          <p className="mt-2 text-sm text-medora-slate">
            Your <strong>{ctx.role}</strong> request is awaiting verification and approval from
            your Hospital Administrator. Privileged clinical and pharmacy features remain locked
            until approved.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/browse" className="medora-btn-outline text-xs">
              Browse Public Catalog
            </Link>
            <Link href="/api/auth/signout" className="medora-btn-primary text-xs">
              Sign Out
            </Link>
          </div>
        </div>
      </div>
    );
  }

  switch (ctx.role) {
    case "PLATFORM_ADMIN":
      redirect("/admin/platform");
    case "HOSPITAL_ADMIN":
      redirect("/admin/hospital");
    case "DOCTOR":
      redirect("/doctor");
    case "PHARMACIST":
      redirect("/pharmacist");
    case "PATIENT":
    default:
      redirect("/patient");
  }
}
