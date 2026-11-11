import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Shortclips Transfer is uitgefaseerd (WeTransfer vervangt het). */
export default function MijnTransfersPage() {
  redirect("/transfer");
}
