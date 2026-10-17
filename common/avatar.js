import { api } from './api.js'
export async function uploadAvatar(filePath) {
  let data
  // #ifdef MP-WEIXIN
  data = await new Promise((resolve,reject) => uni.getFileSystemManager().readFile({filePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
  // #endif
  // #ifdef H5
  const blob = await (await fetch(filePath)).blob()
  data = await new Promise((resolve,reject) => {const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob)})
  // #endif
  const mime = data.startsWith('iVBOR') ? 'png' : data.startsWith('UklGR') ? 'webp' : 'jpeg'
  return api('/me/avatar','POST',{data:'data:image/'+mime+';base64,'+data})
}
