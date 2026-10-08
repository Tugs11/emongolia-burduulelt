// e-Mongolia «Миний мэдээлэл» хэсэг ХУР-ын эдгээр сервисийг /api/routes/xyp-ээр дууддаг.
// Параметрүүдийг (customFields) сайтын my-info-government хуудасны JS-ээс олж, нэвтэрсэн session дээр шалгасан (2026-10-07).
// Регистрийн дугаарыг сервер token-оос өөрөө авдаг тул илгээх шаардлагагүй.
//   perVehicle: тээврийн хэрэгслийн жагсаалтын машин бүрээр (field-ийн утгыг param болгон) тусад нь дуудна.
export function buildSources(now = new Date()) {
  const y = now.getFullYear();
  return [
    { id: "health", name: "Эрүүл мэндийн даатгал", serviceCode: "WS300101_getInsuranceFee" },
    { id: "social", name: "Нийгмийн даатгал (НДШ)", serviceCode: "WS100501_getCitizenSalaryInfo",
      customFields: { startYear: String(y - 1), endYear: String(y), reason: "Төрд байгаа миний мэдээлэл" } },
    { id: "invoice", name: "Төлөгдөөгүй нэхэмжлэх", serviceCode: "WS100439_unpaidInvoiceInfo" },
    { id: "loan", name: "Зээлийн мэдээлэл", serviceCode: "WS100831_citizenLoanInfo" },
    { id: "vehicles", name: "Тээврийн хэрэгсэл", serviceCode: "WS100406_getCitizenVehicleList" },
    { id: "penalty", name: "Тээврийн хэрэгслийн торгууль", serviceCode: "WS100403_getVehiclePenaltyList",
      perVehicle: { field: "plateNumber", param: "plateNumber" } },
    { id: "inspection", name: "Тээврийн хэрэгслийн оношилгоо", serviceCode: "WS100409_getVehicleInspectionInfo",
      perVehicle: { field: "cabinNumber", param: "cabinNumber" } },
    { id: "mandatory", name: "Албан журмын даатгал", serviceCode: "WS100458_MandatoryInsuranceShortList" },
    { id: "idcard", name: "Иргэний үнэмлэх", serviceCode: "WS100101_getCitizenIDCardInfo" },
    { id: "passport", name: "Гадаад паспорт", serviceCode: "WS100110_passportInfo" },
    { id: "property", name: "Үл хөдлөх хөрөнгө", serviceCode: "WS100202_getPropertyList" },
  ];
}

export const SOURCES = buildSources();
