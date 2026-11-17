import { PageHeader } from "@/components/ui";
import { ImportClient } from "@/components/ImportClient";

export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="From a website or a file" title="Import a recipe">
        Paste a recipe URL: the server fetches the page, strips the blog story, the local model turns it into a kitchen recipe, and you edit the preview before saving. The household rule check runs on what you save. Or import a JSON file exported from this app.
      </PageHeader>
      <ImportClient />
    </div>
  );
}
