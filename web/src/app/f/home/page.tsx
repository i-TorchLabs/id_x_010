import ChatHome from "@/views/ChatHome";
import { AuthGuard } from "@/components/AuthGuard";

export default function HomePage() {
  return (
    <AuthGuard>
      <ChatHome />
    </AuthGuard>
  );
}
