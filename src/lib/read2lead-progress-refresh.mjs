/** Only the newest successful server read may paint the account header. */
export function createProgressRefresh({load,apply}) {
  let generation=0;
  return async()=>{
    const current=++generation;
    try {
      const data=await load();
      if(current!==generation||data?.ok!==true||!data.read2lead_state)return false;
      apply(data.read2lead_state);
      return true;
    }catch{return false;}
  };
}
