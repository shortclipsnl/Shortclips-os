import { redirect } from "next/navigation";

// De Klantbericht-tool is uit het portaal gehaald (werd niet gebruikt).
// Oude links komen netjes op het dashboard uit; opgeslagen data blijft bewaard.
export default function BerichtPage() {
  redirect("/dashboard");
}
