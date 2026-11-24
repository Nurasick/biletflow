const {test,expect}=require('@playwright/test');

test('guest opens a public event and reaches ticket selection without signing in',async({page})=>{
  const event={id:7,slug:'guest-event',title:'Guest Preview Concert',description:'Open to everyone',category:'concert',cover_image_url:null,status:'published',visibility:'public',seating_mode:'general_admission',venue_name:'Central Hall',venue_address:'Almaty',starts_at:'2027-05-10T12:00:00Z',ends_at:'2027-05-10T14:00:00Z',timezone:'Asia/Almaty',capacity:100,refund_policy:null,phase:'upcoming',organizer_name:'BiletFlow Demo',images:[],paid_sales_active:true,calendar_links:{google:'https://calendar.google.com/',outlook:'https://outlook.live.com/'}};
  await page.route('**/api/v1/events/guest-event',route=>route.fulfill({json:event}));
  await page.route('**/api/v1/events/guest-event/ticket-types',route=>route.fulfill({json:[{id:1,name:'General',description:null,price_minor:0,currency:'KZT',sales_start_at:null,sales_end_at:null,max_per_order:4,available:4}]}));
  await page.goto('/event-details?slug=guest-event');
  await expect(page.getByText('Guest Preview Concert')).toBeVisible();
  await expect(page.getByRole('button',{name:'Choose tickets'})).toBeEnabled();
  await page.getByRole('button',{name:'Choose tickets'}).click();
  await expect(page.getByRole('button',{name:'Add one General ticket'})).toBeVisible();
});
