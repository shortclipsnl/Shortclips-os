import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireInternal } from "@/server/auth/context";
import { EditStandaardView } from "./edit-standaard-view";

export const metadata: Metadata = { title: "Edit Standaard" };

export default async function EditStandaardPage() {
  await requireInternal();
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Shortclips Edit Standaard"
        description="Zo monteren wij. Bovenaan de standaard in één blik, daaronder de eindcheck voor je oplevert en de uitleg per onderdeel."
      />
      <EditStandaardView />
    </div>
  );
}
