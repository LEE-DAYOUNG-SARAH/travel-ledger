// 초기 데이터: 치앙마이 여행 1개 생성 (여행이 하나도 없을 때만)
// 사용법:  node server/seed.js            → 여행만 생성
//          node server/seed.js --demo     → 데모 지출도 함께 생성 (화면 확인용)
import * as store from './db.js'

const demo = process.argv.includes('--demo')
await store.migrate()
if ((await store.listTrips()).length > 0 && !process.argv.includes('--force')) {
  console.log('이미 여행이 있어 시드를 건너뜁니다. (--force 로 강제)'); process.exit(0)
}

const trip = await store.createTrip({
  title: '치앙마이 한 달 살기', countryCode: 'TH', city: '치앙마이',
  startDate: '2026-10-14', endDate: '2026-11-14',
  localCurrency: 'THB', baseCurrency: 'KRW', exchangeRate: 43.5, budget: 1500000,
})
console.log('여행 생성:', trip.title, trip.id)

if (demo) {
  const R = trip.exchangeRate
  const rows = [
    ['2026-10-14T15:20', 18000, 'LODGING', 'CARD', 'Common Living 11월 임대', '', 'THB'],
    ['2026-10-14T19:05', 180, 'FOOD', 'CASH', '카오소이 + 망고주스', '님만해민', 'THB'],
    ['2026-10-15T09:10', 60, 'FOOD', 'CASH', '아침 커피', 'Ristr8to', 'THB'],
    ['2026-10-15T13:40', 95, 'TRANSPORT', 'CARD', '그랩 올드타운', '', 'THB'],
    ['2026-10-16T11:00', 40, 'SIGHTSEEING', 'CASH', '왓 프라싱 입장', '올드타운', 'THB'],
    ['2026-10-18T20:30', 450, 'SHOPPING', 'CARD', '선데이 마켓 옷', '타패 게이트', 'THB'],
    ['2026-10-21T12:15', 220, 'FOOD', 'CASH', '점심 쌀국수 2인', '', 'THB'],
    ['2026-10-25T16:00', 299, 'ETC', 'CARD', '유심 30일', 'AIS', 'THB'],
    ['2026-10-29T09:30', 1200, 'TRANSPORT', 'CARD', '스쿠터 렌탈 1주', '', 'THB'],
    ['2026-11-01T18:45', 320, 'FOOD', 'CARD', '저녁 북부요리', '', 'THB'],
    ['2026-11-02T10:20', 150, 'SIGHTSEEING', 'CASH', '도이수텝 셔틀', '', 'THB'],
    ['2026-11-03T12:30', 120, 'FOOD', 'CASH', '카오소이', '님만해민', 'THB'],
    ['2026-11-03T15:00', 85, 'FOOD', 'CASH', '카페', '', 'THB'],
  ]
  for (const [spentAt, amt, category, paymentMethod, memo, place] of rows) {
    await store.createExpense({ tripId: trip.id, amountLocal: amt, amountBase: Math.round(amt * R), currency: 'THB',
      category, paymentMethod, exchangeRate: R, memo, place, spentAt: spentAt + ':00' })
  }
  console.log(`데모 지출 ${rows.length}건 생성`)
}
