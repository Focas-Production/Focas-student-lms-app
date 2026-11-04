// Foundation students' admission details — shared bits for the form page
// (pages/student/MyDetailsPage.jsx) and the reminder (components/DetailsReminder.jsx).
// Server side: server/services/studentDetailsService.js.
import { apiFetch } from '../api'

// Fired after any save/upload so the reminder banner re-checks the status.
export const DETAILS_CHANGED = 'student-details-changed'
export const notifyDetailsChanged = () => window.dispatchEvent(new Event(DETAILS_CHANGED))

export const STATUS_TEXT = {
  not_started: 'Not filled yet',
  incomplete:  'Not submitted yet',
  submitted:   'Submitted — waiting for the office to check',
  needs_fix:   'Some documents need to be uploaded again',
  approved:    'All done — approved',
}

export const DOC_STATUS_TEXT = {
  pending:  'Waiting for check',
  approved: 'Approved',
  rejected: 'Upload again',
}

// Still something for the student to do?
export const needsAction = (status) => ['not_started', 'incomplete', 'needs_fix'].includes(status)

// '919876543210' → '9876543210' for the input box; the server adds 91 back.
export const phoneForInput = (p) => (p && /^91\d{10}$/.test(p) ? p.slice(2) : p || '')

export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// A dropdown instead of free text keeps "TN" / "Tamilnadu" / "tamil nadu"
// out of the records. An older free-text value is still shown if present.
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

// ── per-step checks (same rules as the server's parseInput / missingItems,
// so the student hears about a mistake on the step where they made it) ──
const MOBILE = /^[6-9]\d{9}$/
const blank = (v) => !String(v ?? '').trim()

export function validateStep(step, form) {
  const e = {}
  if (step === 'contact') {
    if (!MOBILE.test(form.studentPhone)) e.studentPhone = 'Enter your 10-digit mobile number'
    if (blank(form.parentName)) e.parentName = "Enter your parent's name"
    if (!MOBILE.test(form.parentPhone)) e.parentPhone = "Enter your parent's 10-digit mobile number"
  }
  if (step === 'address') {
    if (blank(form.address.line)) e['address.line'] = 'Enter your house no., street and area'
    if (blank(form.address.city)) e['address.city'] = 'Enter your city or town'
    if (blank(form.address.state)) e['address.state'] = 'Choose your state'
    if (!/^[1-9]\d{5}$/.test(form.address.pincode)) e['address.pincode'] = 'Enter the 6-digit pincode'
  }
  if (step === 'school') {
    if (blank(form.school.name)) e['school.name'] = 'Enter your school name'
    if (blank(form.school.city)) e['school.city'] = 'Enter the city of your school'
    if (!form.school.board) e['school.board'] = 'Choose your board'
    else if (form.school.board === 'OTHER' && blank(form.school.boardOther)) e['school.boardOther'] = 'Type the name of your board'
    if (!form.school.subjects.length) e['school.subjects'] = 'Tick at least one subject'
  }
  return e
}

// Big phone photos are shrunk to a ≤2000px JPEG before upload: a 12 MB camera
// shot becomes ~0.5–1 MB, uploads fast on mobile data and stays readable.
// PDFs and already-small images go up untouched. Any failure → original file.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 1.5 * 1024 * 1024) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'                        // PNG transparency → white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close?.()
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function putToR2(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}) — please try again`)))
    xhr.onerror = () => reject(new Error('Upload failed — check your internet and try again'))
    xhr.send(file)
  })
}

/**
 * presign → PUT straight to storage → commit. `base` is the API prefix
 * ('/api/student-details/me'). Returns the server's { details }.
 */
export async function uploadDocument(base, type, original, { allowedTypes, maxFileBytes }, onProgress) {
  if (!allowedTypes.includes(original.type)) throw new Error('Choose a photo (JPG / PNG) or a PDF file')
  const file = await shrinkImage(original)
  if (file.size > maxFileBytes) throw new Error(`The file is larger than ${Math.round(maxFileBytes / 1048576)} MB — choose a smaller one`)
  if (file.size === 0) throw new Error('That file is empty')
  const pre = await apiFetch(`${base}/documents/${type}/presign`, {
    method: 'POST', body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size }),
  })
  await putToR2(pre.uploadUrl, file, onProgress)
  return apiFetch(`${base}/documents/${type}`, { method: 'POST', body: JSON.stringify({ key: pre.key, name: file.name }) })
}
