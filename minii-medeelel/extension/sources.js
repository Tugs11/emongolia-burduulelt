// e-Mongolia «Миний мэдээлэл» хэсэг ХУР-ын эдгээр сервисийг /api/routes/xyp-ээр дууддаг
// (сайтын JS-ээс 2026-10-07-нд олсон). verified: бодит нэвтэрсэн session дээр шалгасан эсэх.
// Зарим сервис нэмэлт параметр (жишээ нь улсын дугаар) шаардаж магадгүй — эхний ажиллуулалтын статусаас харна.
export const SOURCES = [
  { id: "health", name: "Эрүүл мэндийн даатгал", serviceCode: "WS300101_getInsuranceFee", verified: true },
  { id: "social", name: "Нийгмийн даатгал (НДШ)", serviceCode: "WS100501_getCitizenSalaryInfo", verified: false },
  { id: "penalty", name: "Тээврийн хэрэгслийн торгууль", serviceCode: "WS100403_getVehiclePenaltyList", verified: false },
  { id: "invoice", name: "Төлөгдөөгүй нэхэмжлэх", serviceCode: "WS100439_unpaidInvoiceInfo", verified: true },
  { id: "loan", name: "Зээлийн мэдээлэл", serviceCode: "WS100831_citizenLoanInfo", verified: true },
  { id: "vehicles", name: "Тээврийн хэрэгсэл", serviceCode: "WS100406_getCitizenVehicleList", verified: true },
  { id: "mandatory", name: "Албан журмын даатгал", serviceCode: "WS100458_MandatoryInsuranceShortList", verified: true },
  { id: "idcard", name: "Иргэний үнэмлэх", serviceCode: "WS100101_getCitizenIDCardInfo", verified: true },
  { id: "passport", name: "Гадаад паспорт", serviceCode: "WS100110_passportInfo", verified: true },
  { id: "property", name: "Үл хөдлөх хөрөнгө", serviceCode: "WS100202_getPropertyList", verified: true },
];
