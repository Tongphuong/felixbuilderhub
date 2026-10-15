/** Standalone SpeakUp is retired; shared reading speech handlers remain active. */
export function speakingRetiredResponse() {
  return new Response(JSON.stringify({ ok: false, error: 'standalone_speaking_retired',
    message: 'Minny luyện nói cùng con trong mỗi câu chuyện. Bài đã lưu của con vẫn còn.',
    reading_path: '/read2lead?from=speaking',
  }), { status: 410, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
