export default function RecordPager({ records }) {
  return (
    <div className="flex gap-4 items-center my-4 print:hidden">
      <button disabled={!records.page} onClick={records.previous}>
        Previous records
      </button>
      <span>Page {records.page + 1}</span>
      <button disabled={!records.more} onClick={records.next}>
        Next records
      </button>
      <span role="status">{records.error}</span>
    </div>
  );
}
