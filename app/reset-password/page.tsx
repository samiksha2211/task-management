import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import "../globals.css";
import "@/components/login/LoginForm.css";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  return <ResetPasswordForm initialToken={token ?? ""} />;
}
