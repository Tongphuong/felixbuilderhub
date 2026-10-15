// Bot ranking injection retired. Historical account data is preserved.
export async function onRequestPost() {
  return Response.json({ok:false,error:'bot_ranking_retired',message:'Bảng thành tích chỉ ghi nhận kết quả học tập thật.'},{status:410,headers:{'Cache-Control':'no-store'}});
}
