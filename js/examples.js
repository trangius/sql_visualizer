'use strict';

// ─── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES = {
  school: `# SchoolDatabase
Student
  Id
  Name vc(100)
  Email vc(100) unique
  DateOfBirth date null

Teacher
  Id
  Name vc(100)
  Email vc(100) unique

Course
  Id
  Name vc(100)
  Credits int
  TeacherId null -> Teacher [delete set null]  # null = no teacher yet

# Junction table: Student ↔ Course
Enrollment
  StudentId -> Student [delete cascade]
  CourseId -> Course [delete cascade]
  EnrollmentDate date [default now]
  Grade int null  # null = not graded yet
  pk (StudentId, CourseId)
`,
  dogs: `# DogExhibition
Owner
  Id
  Name

Breed
  Id
  Name

Dog
  Id
  Name
  Age int
  OwnerId -> Owner
  BreedId -> Breed
  Points decimal(3,1)
`,
  projects: `# ProjectDatabase
Project
  Id
  Name
  Description text

Task
  Id
  Name
  Description text
  StartDate date
  EndDate date
  ProjectId -> Project

EtoT
  EmployeeId -> Employee
  TaskId -> Task
  HoursWorked int

Employee
  Id
  Name
  Email
`,
  store: `# ClothingShop
ReturnStatus
  Id
  Name

OrderStatus
  Id
  Name

Customer
  Id
  Fname
  LName
  Address
  Email

ProductCategory
  Id
  Name
  ParentCategoryId null -> ProductCategory

ProductPrice
  Id
  ProductId -> Product
  StartDate datetime
  Price int

Product
  Id
  Name
  Description text
  CategoryId -> ProductCategory

Variant
  Id
  ProductId -> Product
  Name
  Description text
  ImageURL vc(256)
  Stock int

COrder
  Id
  CreatedDate datetime
  StatusId -> OrderStatus
  CustomerId -> Customer

ProductToOrder
  Id
  OrderId -> COrder
  VariantId -> Variant
  Name
  Description text
  Quantity int
  UnitPrice decimal(10,2)

Return
  Id
  PToOId -> ProductToOrder
  QuantityReturned int
  IncomeDate date
  BackToCDate date null
  ReturnStatusId -> ReturnStatus
  Reason text
  HandlerNote text
`,
};
