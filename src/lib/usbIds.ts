type GetUsbResponse = {
  version: string;
  date: string;
  vendors: {
    id: string;
    name: string;
    devices: {
      id: string;
      name: string;
    }[];
  }[];
};

export async function getUsbName(vid: number, pid: number) {
  const params = new URLSearchParams({
    vid: vid.toString(16).padStart(4, "0"),
    pid: pid.toString(16).padStart(4, "0"),
  });

  try {
    const response = await fetch(
      `https://apps.sebastianlang.net/usb-ids?${params}`,
    );

    const data = (await response.json()) as GetUsbResponse;

    if (data.vendors.length === 0 || data.vendors[0].devices.length === 0) {
      return undefined;
    }

    return `${data.vendors[0].name} - ${data.vendors[0].devices[0].name}`;
  } catch (e) {
    return undefined;
  }
}
