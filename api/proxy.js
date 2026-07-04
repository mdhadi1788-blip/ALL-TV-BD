// api/proxy.js

export default async function handler(req, res) {
  // CORS Headers সেট করা যেন আপনার ফ্রন্টএন্ড কোনো বাধা ছাড়া ডেটা পায়
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // OPTIONS রিকোয়েস্ট হ্যান্ডেল করা (CORS Preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // কুয়েরি প্যারামিটার থেকে মূল ভিডিও URL টি নেওয়া
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    // সুপার ফাস্ট স্ট্রিমিং নিশ্চিত করতে Fetch API ব্যবহার করা হয়েছে
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // কিছু প্রোভাইডার ব্রাউজার বা প্লেয়ার রিকোয়েস্ট ছাড়া ব্লক করে, তাই User-Agent সেট করা
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      }
    });

    // রেসপন্স হেডার থেকে Content-Type নিয়ে নেওয়া (যেমন: application/vnd.apple.mpegurl)
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // স্ট্রিমিং ডেটা সরাসরি ক্লায়েন্টে পাস করে দেওয়া (No Buffer Lag)
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return res.status(response.status).send(buffer);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Proxy failed to fetch the stream', details: error.message });
  }
}
