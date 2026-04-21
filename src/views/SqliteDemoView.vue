<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue'
import {type QTableColumn, useQuasar} from 'quasar'
import {
  createDemoUser,
  deleteDemoUser,
  queryDemoUserById,
  queryDemoUsersPage,
  updateDemoUser,
} from '../api/sqlite-demo'
import type {DemoUser} from '../entities/demo-user'

defineOptions({name: 'sqlite-demo'})

const $q = useQuasar()

const loading = ref(false)
const users = ref<DemoUser[]>([])
const keyword = ref('')
const form = reactive({
  id: undefined as number | undefined,
  name: '',
  age: 18,
  email: '',
})
const pagination = ref({
  page: 1,
  rowsPerPage: 10,
  rowsNumber: 0,
})

const columns: QTableColumn<DemoUser>[] = [
  {name: 'id', label: 'ID', field: 'id', align: 'left', sortable: true},
  {name: 'name', label: '姓名', field: 'name', align: 'left'},
  {name: 'age', label: '年龄', field: 'age', align: 'left'},
  {name: 'email', label: '邮箱', field: 'email', align: 'left'},
  {name: 'createdAt', label: '创建时间', field: 'createdAt', align: 'left'},
  {name: 'updatedAt', label: '更新时间', field: 'updatedAt', align: 'left'},
  {name: 'actions', label: '操作', field: () => '', align: 'left'},
]

const isEditMode = computed(() => Number.isInteger(form.id))

const showError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  $q.notify({
    type: 'negative',
    message,
  })
}

const showSuccess = (message: string) => {
  $q.notify({
    type: 'positive',
    message,
  })
}

const resetForm = () => {
  form.id = undefined
  form.name = ''
  form.age = 18
  form.email = ''
}

const normalizeForm = () => {
  const name = form.name.trim()
  const email = form.email.trim()
  const age = Number(form.age)

  if (!name) throw new Error('姓名不能为空')
  if (!email) throw new Error('邮箱不能为空')
  if (!Number.isFinite(age) || age < 0) throw new Error('年龄必须是大于等于 0 的数字')

  return {
    name,
    email,
    age,
  }
}

const queryUsersPage = async () => {
  return await queryDemoUsersPage({
    page: pagination.value.page,
    pageSize: pagination.value.rowsPerPage,
    keyword: keyword.value,
  })
}

const loadUsers = async () => {
  loading.value = true

  try {
    const pageResult = await queryUsersPage()

    if (pageResult.total > 0 && pageResult.list.length === 0 && pagination.value.page > 1) {
      pagination.value.page -= 1
      const previousPageResult = await queryUsersPage()
      users.value = previousPageResult.list
      pagination.value.rowsNumber = previousPageResult.total
      return
    }

    users.value = pageResult.list
    pagination.value.rowsNumber = pageResult.total
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

const handleSearch = async () => {
  pagination.value.page = 1
  await loadUsers()
}

const handleResetSearch = async () => {
  keyword.value = ''
  pagination.value.page = 1
  await loadUsers()
}

const handleTableRequest = async (payload: {
  pagination: {
    page: number
    rowsPerPage: number
    rowsNumber?: number
  }
}) => {
  pagination.value = {
    page: payload.pagination.page,
    rowsPerPage: payload.pagination.rowsPerPage,
    rowsNumber: payload.pagination.rowsNumber ?? pagination.value.rowsNumber,
  }
  await loadUsers()
}

const handleCreate = async () => {
  try {
    const payload = normalizeForm()
    await createDemoUser(payload)
    await loadUsers()
    resetForm()
    showSuccess('新增成功')
  } catch (error) {
    showError(error)
  }
}

const handleUpdate = async () => {
  if (!form.id) {
    showError(new Error('请先点击表格中的“编辑”'))
    return
  }

  try {
    const payload = normalizeForm()
    const updated = await updateDemoUser({
      id: form.id,
      ...payload,
    })

    if (!updated) throw new Error('未找到要更新的数据')

    await loadUsers()
    resetForm()
    showSuccess('更新成功')
  } catch (error) {
    showError(error)
  }
}

const handleDelete = async (row: DemoUser) => {
  try {
    const deleted = await deleteDemoUser(row.id)
    if (!deleted) throw new Error('未找到要删除的数据')

    if (form.id === row.id) {
      resetForm()
    }

    await loadUsers()
    showSuccess('删除成功')
  } catch (error) {
    showError(error)
  }
}

const handleEdit = async (id: number) => {
  try {
    const user = await queryDemoUserById(id)
    if (!user) throw new Error('未找到要编辑的数据')

    form.id = user.id
    form.name = user.name
    form.age = user.age
    form.email = user.email
  } catch (error) {
    showError(error)
  }
}

onMounted(async () => {
  await loadUsers()
})
</script>

<template>
  <div class="page">
    <q-card flat bordered class="panel">
      <q-card-section class="panel-section">
        <div class="header">
          <div>
            <p class="title">SQLite CRUD Demo</p>
            <p class="tip">业务层写 SQL，主进程仅提供 execute SQL 接口</p>
          </div>
          <q-btn color="primary" no-caps unelevated @click="loadUsers">刷新列表</q-btn>
        </div>

        <div class="search-row">
          <q-input
            v-model="keyword"
            outlined
            dense
            clearable
            label="搜索"
            placeholder="按姓名/邮箱搜索"
            @keyup.enter="handleSearch"
          />
          <q-btn color="primary" no-caps unelevated @click="handleSearch">搜索</q-btn>
          <q-btn outline color="primary" no-caps @click="handleResetSearch">清空</q-btn>
        </div>

        <div class="form-grid">
          <q-input
            v-model="form.name"
            outlined
            dense
            label="姓名"
            placeholder="请输入姓名"
          />
          <q-input
            v-model.number="form.age"
            outlined
            dense
            label="年龄"
            type="number"
            min="0"
            placeholder="请输入年龄"
          />
          <q-input
            v-model="form.email"
            outlined
            dense
            label="邮箱"
            placeholder="请输入邮箱"
          />
        </div>

        <div class="actions">
          <q-btn color="primary" no-caps unelevated @click="handleCreate">新增</q-btn>
          <q-btn
            color="secondary"
            no-caps
            unelevated
            :disable="!isEditMode"
            @click="handleUpdate"
          >
            保存更新
          </q-btn>
          <q-btn outline color="primary" no-caps @click="resetForm">重置</q-btn>
        </div>

        <q-table
          flat
          bordered
          :rows="users"
          :columns="columns"
          row-key="id"
          v-model:pagination="pagination"
          :loading="loading"
          :rows-per-page-options="[5, 10, 20, 50]"
          @request="handleTableRequest"
          class="table"
        >
          <template #body-cell-actions="props">
            <q-td :props="props">
              <div class="row-actions">
                <q-btn
                  size="sm"
                  color="primary"
                  no-caps
                  flat
                  @click="handleEdit(props.row.id)"
                >
                  编辑
                </q-btn>
                <q-btn
                  size="sm"
                  color="negative"
                  no-caps
                  flat
                  @click="handleDelete(props.row)"
                >
                  删除
                </q-btn>
              </div>
            </q-td>
          </template>
        </q-table>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.page {
  padding: 18px 12px;
}

.panel {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
  margin: 0 auto;
  max-width: 1100px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.tip {
  color: var(--app-text-secondary);
  margin: 4px 0 0;
}

.form-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.search-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.table {
  background: transparent;
}

.row-actions {
  display: flex;
  gap: 4px;
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .header {
    align-items: stretch;
    flex-direction: column;
  }

  .form-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }
}
</style>
