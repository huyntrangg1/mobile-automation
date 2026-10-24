import { PageHeader, Empty } from '../components/ui.jsx';

export function Placeholder({ title }) {
  return (
    <main className="content">
      <PageHeader title={title} />
      <section className="card"><Empty title="Chưa có nội dung" /></section>
    </main>
  );
}
