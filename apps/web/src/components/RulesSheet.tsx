export default function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-slate-900 p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="กติกา"
      >
        <h2 className="mb-3 text-xl font-bold">กติกาไพ่สลาฟ</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-white/85">
          <li>ไพ่ 52 ใบ แจกให้ทุกคนจนหมด (4 คน = คนละ 13 ใบ)</li>
          <li>ลำดับไพ่จากเล็กไปใหญ่: 3 4 5 6 7 8 9 10 J Q K A 2</li>
          <li>ถ้าเลขเท่ากัน เทียบดอก: ♣ &lt; ♦ &lt; ♥ &lt; ♠</li>
          <li>ลงได้ทั้งเดี่ยว คู่ ตอง และโฟร์ คนตามต้องลงจำนวนใบเท่ากันและต้องใหญ่กว่า</li>
          <li>รอบแรก คนที่ถือ 3♣ เป็นคนเริ่ม และต้องลงไพ่ที่มี 3♣ อยู่ด้วย</li>
          <li>จะลงหรือผ่านก็ได้ ถ้าผ่านแล้วจะลงซ้ำในกองนั้นไม่ได้ เมื่อทุกคนผ่าน คนที่ลงล่าสุดได้เปิดกองใหม่</li>
          <li>ใครหมดมือก่อนได้ตำแหน่งสูงกว่า: กษัตริย์, ขุนนาง, ไพร่, ทาส</li>
          <li>รอบถัดไป ทาสต้องให้ไพ่ใหญ่สุด 2 ใบกับกษัตริย์ และไพร่ให้ 1 ใบกับขุนนาง จากนั้นฝ่ายที่ได้รับเลือกไพ่คืนให้ในจำนวนเท่ากัน</li>
          <li>ทาสเป็นคนเริ่มเล่นในรอบนั้น</li>
          <li>เจ้าของห้องเปิดกติกาเสริมได้: ลงเรียง, ปฏิวัติ (ลงโฟร์แล้วลำดับไพ่กลับด้าน), ห้ามจบด้วย 2</li>
        </ul>
        <button className="btn btn-primary mt-5 w-full" onClick={onClose}>
          เข้าใจแล้ว
        </button>
      </div>
    </div>
  );
}
